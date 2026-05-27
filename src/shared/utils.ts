/**
 * Helper to calculate SHA-256 using the Web Crypto API.
 * This works in both the Devvit runtime and modern Node.js (Node 22+).
 */
export async function generateHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  // Using the built-in crypto library available in the environment
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
