import { AsyncEntry } from "@napi-rs/keyring";

export interface CredentialStore {
  get(provider: string, name: string): Promise<string | undefined>;
  set(provider: string, name: string, value: string): Promise<void>;
}

export class KeyringCredentialStore implements CredentialStore {
  constructor(private readonly service = "ani-resolver") {}

  async get(provider: string, name: string): Promise<string | undefined> {
    return new AsyncEntry(this.service, `${provider}:${name}`).getPassword();
  }

  async set(provider: string, name: string, value: string): Promise<void> {
    await new AsyncEntry(this.service, `${provider}:${name}`).setPassword(value);
  }
}
