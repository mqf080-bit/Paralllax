/**
 * 从音频文件里读标题 / 作者 / 封面。
 *
 * 浏览器 decodeAudioData 只给 PCM，不给标签；这里手动读：
 * - FLAC：PICTURE 元数据块 / Vorbis comment 里的 METADATA_BLOCK_PICTURE；
 * - MP3：ID3v2 的 TIT2 / TPE1 / TALB / APIC。
 *
 * 读不到就返回空对象；编辑器仍然允许手动指定封面。
 */

export interface AudioCover {
  data: Uint8Array;
  type: string;
}

export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  cover?: AudioCover;
}

export async function extractAudioMetadata(file: File): Promise<AudioMetadata> {
  const buffer = await file.arrayBuffer();
  const flac = parseFlac(buffer);
  if (flac) return flac;
  const mp3 = parseMp3(buffer);
  if (mp3) return mp3;
  return {};
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  ) >>> 0;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function syncsafe(value: number): number {
  return ((value & 0x7f000000) >>> 3) | ((value & 0x007f0000) >>> 2) | ((value & 0x00007f00) >>> 1) | (value & 0x0000007f);
}

function indexOfZero(bytes: Uint8Array, from: number, end = bytes.length): number {
  for (let i = from; i < end; i += 1) if (bytes[i] === 0) return i;
  return end;
}

function indexOfDoubleZero(bytes: Uint8Array, from: number, end = bytes.length): number {
  for (let i = from; i + 1 < end; i += 1) if (bytes[i] === 0 && bytes[i + 1] === 0) return i;
  return end;
}

function decodeText(bytes: Uint8Array, offset: number, end: number, encoding: number): string {
  const slice = bytes.subarray(offset, end);
  try {
    if (encoding === 1) return new TextDecoder('utf-16').decode(slice).replace(/\0+$/, '');
    if (encoding === 2) return new TextDecoder('utf-16be').decode(slice).replace(/\0+$/, '');
    if (encoding === 3) return new TextDecoder('utf-8').decode(slice).replace(/\0+$/, '');
    return new TextDecoder('iso-8859-1').decode(slice).replace(/\0+$/, '');
  } catch {
    return new TextDecoder().decode(slice).replace(/\0+$/, '');
  }
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function coverMime(bytes: Uint8Array, fallback: string): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(bytes, 0, 3) === 'GIF') return 'image/gif';
  return fallback || 'image/jpeg';
}

interface RawPicture {
  type: number;
  mime: string;
  data: Uint8Array;
}

function parsePicturePayload(bytes: Uint8Array): RawPicture | null {
  if (bytes.length < 32) return null;
  let offset = 0;
  const pictureType = u32be(bytes, offset);
  offset += 4;
  const mimeLength = u32be(bytes, offset);
  offset += 4;
  if (offset + mimeLength > bytes.length) return null;
  const mime = ascii(bytes, offset, mimeLength);
  offset += mimeLength;
  const descriptionLength = u32be(bytes, offset);
  offset += 4;
  offset += descriptionLength;
  offset += 4 * 4; // width / height / depth / colors
  if (offset + 4 > bytes.length) return null;
  const dataLength = u32be(bytes, offset);
  offset += 4;
  if (offset + dataLength > bytes.length) return null;
  return { type: pictureType, mime, data: bytes.slice(offset, offset + dataLength) };
}

function betterPicture(current: RawPicture | undefined, candidate: RawPicture): RawPicture {
  if (!current) return candidate;
  // type 3 = front cover，优先。
  if (current.type !== 3 && candidate.type === 3) return candidate;
  return current;
}

function parseFlac(buffer: ArrayBuffer): AudioMetadata | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4 || ascii(bytes, 0, 4) !== 'fLaC') return null;

  const metadata: AudioMetadata = {};
  let picture: RawPicture | undefined;
  let offset = 4;
  while (offset + 4 <= bytes.length) {
    const header = bytes[offset]!;
    const last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const length = ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    offset += 4;
    const end = offset + length;
    if (end > bytes.length) break;

    if (type === 6) {
      const parsed = parsePicturePayload(bytes.subarray(offset, end));
      if (parsed) picture = betterPicture(picture, parsed);
    } else if (type === 4) {
      const comments = parseVorbisComments(bytes.subarray(offset, end));
      metadata.title = comments.title ?? metadata.title;
      metadata.artist = comments.artist ?? metadata.artist;
      metadata.album = comments.album ?? metadata.album;
      for (const raw of comments.pictures) {
        const parsed = parsePicturePayload(raw);
        if (parsed) picture = betterPicture(picture, parsed);
      }
      if (comments.cover && comments.cover.length > 0) {
        const parsed: RawPicture = {
          type: 3,
          mime: comments.coverMime ?? 'image/jpeg',
          data: comments.cover,
        };
        picture = betterPicture(picture, parsed);
      }
    }

    if (last) break;
    offset = end;
  }

  if (picture) {
    metadata.cover = { data: picture.data, type: coverMime(picture.data, picture.mime) };
  }
  return metadata.title || metadata.artist || metadata.album || metadata.cover ? metadata : {};
}

function parseVorbisComments(bytes: Uint8Array): {
  title?: string;
  artist?: string;
  album?: string;
  pictures: Uint8Array[];
  cover?: Uint8Array;
  coverMime?: string;
} {
  const result: {
    title?: string;
    artist?: string;
    album?: string;
    pictures: Uint8Array[];
    cover?: Uint8Array;
    coverMime?: string;
  } = { pictures: [] };
  let offset = 0;
  if (offset + 4 > bytes.length) return result;
  const vendorLength = u32le(bytes, offset);
  offset += 4;
  offset += vendorLength;
  if (offset + 4 > bytes.length) return result;
  const count = u32le(bytes, offset);
  offset += 4;

  for (let i = 0; i < count && offset + 4 <= bytes.length; i += 1) {
    const length = u32le(bytes, offset);
    offset += 4;
    if (offset + length > bytes.length) break;
    const comment = new TextDecoder('utf-8').decode(bytes.subarray(offset, offset + length));
    offset += length;
    const equals = comment.indexOf('=');
    if (equals <= 0) continue;
    const key = comment.slice(0, equals).toUpperCase();
    const value = comment.slice(equals + 1);
    if (key === 'TITLE') result.title = value;
    else if (key === 'ARTIST') result.artist = value;
    else if (key === 'ALBUM') result.album = value;
    else if (key === 'METADATA_BLOCK_PICTURE') {
      const decoded = base64Bytes(value);
      if (decoded) result.pictures.push(decoded);
    } else if (key === 'COVERART') {
      const decoded = base64Bytes(value);
      if (decoded) result.cover = decoded;
    } else if (key === 'COVERARTMIME') {
      result.coverMime = value.trim();
    }
  }
  return result;
}

function parseMp3(buffer: ArrayBuffer): AudioMetadata | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== 'ID3') return null;
  const version = bytes[3]!;
  if (version < 2 || version > 4) return null;
  const tagSize = syncsafe(
    ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0),
  );
  const end = Math.min(bytes.length, 10 + tagSize);
  const metadata: AudioMetadata = {};
  let picture: RawPicture | undefined;

  if (version === 2) {
    let offset = 10;
    while (offset + 6 <= end) {
      const id = ascii(bytes, offset, 3);
      const size = ((bytes[offset + 3] ?? 0) << 16) | ((bytes[offset + 4] ?? 0) << 8) | (bytes[offset + 5] ?? 0);
      offset += 6;
      if (!id.trim() || size <= 0 || offset + size > end) break;
      const frame = bytes.subarray(offset, offset + size);
      if (id === 'TT2') metadata.title = decodeText(frame, 1, frame.length, frame[0] ?? 0) || metadata.title;
      else if (id === 'TP1') metadata.artist = decodeText(frame, 1, frame.length, frame[0] ?? 0) || metadata.artist;
      else if (id === 'TAL') metadata.album = decodeText(frame, 1, frame.length, frame[0] ?? 0) || metadata.album;
      else if (id === 'PIC') {
        const format = ascii(frame, 1, 3).toUpperCase();
        const type = frame[4] ?? 0;
        const descEnd = indexOfZero(frame, 5);
        const dataStart = Math.min(frame.length, descEnd + 1);
        picture = betterPicture(picture, {
          type,
          mime: format === 'PNG' ? 'image/png' : 'image/jpeg',
          data: frame.slice(dataStart),
        });
      }
      offset += size;
    }
  } else {
    let offset = 10;
    while (offset + 10 <= end) {
      const id = ascii(bytes, offset, 4);
      if (!id.trim() || id === '\0\0\0\0') break;
      const size =
        version === 4
          ? syncsafe(
              ((bytes[offset + 4] ?? 0) << 21) |
                ((bytes[offset + 5] ?? 0) << 14) |
                ((bytes[offset + 6] ?? 0) << 7) |
                (bytes[offset + 7] ?? 0),
            )
          : u32be(bytes, offset + 4);
      offset += 10;
      if (size <= 0 || offset + size > end) break;
      const frame = bytes.subarray(offset, offset + size);
      if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') {
        const encoding = frame[0] ?? 0;
        const value = decodeText(frame, 1, frame.length, encoding);
        if (id === 'TIT2') metadata.title = value || metadata.title;
        else if (id === 'TPE1') metadata.artist = value || metadata.artist;
        else metadata.album = value || metadata.album;
      } else if (id === 'APIC' && frame.length > 4) {
        const encoding = frame[0] ?? 0;
        const mimeEnd = indexOfZero(frame, 1);
        const mime = ascii(frame, 1, mimeEnd - 1);
        let cursor = mimeEnd + 1;
        if (cursor >= frame.length) {
          offset += size;
          continue;
        }
        const type = frame[cursor] ?? 0;
        cursor += 1;
        const descEnd =
          encoding === 1 || encoding === 2 ? indexOfDoubleZero(frame, cursor) : indexOfZero(frame, cursor);
        cursor = Math.min(frame.length, descEnd + (encoding === 1 || encoding === 2 ? 2 : 1));
        picture = betterPicture(picture, { type, mime, data: frame.slice(cursor) });
      }
      offset += size;
    }
  }

  if (picture) metadata.cover = { data: picture.data, type: coverMime(picture.data, picture.mime) };
  return metadata.title || metadata.artist || metadata.album || metadata.cover ? metadata : {};
}
