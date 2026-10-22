export async function readRequestBody(
  request: Request | Response,
  maxBodyBytes: number,
): Promise<string> {
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      await request.body?.cancel();
      throw new Error('PAYLOAD_TOO_LARGE');
    }
  }

  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const readResult = await reader.read();
      if (readResult.done) {
        break;
      }

      if (!readResult.value) {
        continue;
      }

      totalBytes += readResult.value.byteLength;
      if (totalBytes > maxBodyBytes) {
        await reader.cancel();
        throw new Error('PAYLOAD_TOO_LARGE');
      }

      chunks.push(readResult.value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let writeOffset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}
