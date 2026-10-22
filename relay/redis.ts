export async function runUpstashCommand(
  restUrl: string,
  restToken: string,
  command: string[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(restUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${restToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
      redirect: 'error',
    });

    const body = (await response.json()) as Record<string, unknown>;
    if (body.error) throw new Error('Relay storage request failed');

    if (!response.ok) {
      throw new Error(`Upstash command failed with HTTP ${response.status}`);
    }

    return Reflect.get(body, 'result');
  } catch {
    throw new Error('Relay storage request failed');
  } finally {
    clearTimeout(timeout);
  }
}
