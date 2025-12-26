
// set-local-env.js
import fs from 'fs';

const vaultUrl = "https://ApiStorage.vault.azure.net/";

// Set environment variable for local dev
process.env.AZURE_KEY_VAULT_URL = vaultUrl;

console.log(`✅ Local dev environment set: AZURE_KEY_VAULT_URL = ${vaultUrl}`);
