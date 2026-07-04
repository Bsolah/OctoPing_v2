/**
 * Production secrets loader.
 *
 * Local: process.env / .env files (via scripts/setup-secrets.sh)
 * Production: AWS Secrets Manager or HashiCorp Vault
 */

export type SecretProvider = 'env' | 'aws' | 'vault';

function provider(): SecretProvider {
  const value = (process.env.SECRETS_PROVIDER ?? 'env').toLowerCase();
  if (value === 'aws' || value === 'vault') {
    return value;
  }
  return 'env';
}

/**
 * Resolves a secret by name. In production, wire AWS/Vault SDKs here.
 * Never log the returned value.
 */
export async function getSecret(name: string): Promise<string> {
  const mode = provider();

  if (mode === 'env') {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Missing required secret: ${name}`);
    }
    return value;
  }

  if (mode === 'aws') {
    // Placeholder for AWS Secrets Manager integration.
    // const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
    // const result = await client.send(new GetSecretValueCommand({ SecretId: name }));
    // return result.SecretString!;
    throw new Error(
      'AWS Secrets Manager provider not configured — set SECRETS_PROVIDER=env for local use',
    );
  }

  // Vault
  throw new Error(
    'HashiCorp Vault provider not configured — set SECRETS_PROVIDER=env for local use',
  );
}

export async function requireSecrets(names: string[]): Promise<void> {
  await Promise.all(names.map((name) => getSecret(name)));
}
