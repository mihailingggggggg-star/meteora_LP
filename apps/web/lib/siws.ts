export function buildMessage(address: string, nonce: string, host: string) {
  const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  return `${host} wants you to sign in with your Solana account:
${address}

Meteora Terminal — привязка кошелька к торговому терминалу.

Nonce: ${nonce}
Issued At: ${new Date().toISOString()}
URI: ${proto}://${host}
Version: 1
Chain ID: mainnet`;
}
