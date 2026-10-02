import "server-only";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "baileys";
import { sb } from "../db";

/**
 * WhatsApp session storage in Supabase (table `wa_auth`), so the worker can restart or move
 * to another machine without scanning the QR code again. Same layout as Baileys'
 * file-based store: one row for "creds" plus one row per signal key ("<type>-<id>").
 */
export async function supabaseAuthState(accountId: string) {
  const { BufferJSON, initAuthCreds, proto } = await import("baileys");

  const encode = (value: unknown) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  const decode = (value: unknown) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);

  const { data: credsRow, error } = await sb().from("wa_auth").select("value").eq("account_id", accountId).eq("key", "creds").maybeSingle();
  if (error) throw new Error(`Supabase: could not load WhatsApp session: ${error.message}`);
  const creds: AuthenticationCreds = credsRow ? decode(credsRow.value) : initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const out: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        if (!ids.length) return out;
        const keys = ids.map((i) => `${type}-${i}`);
        for (let i = 0; i < keys.length; i += 200) {
          const { data, error: e } = await sb().from("wa_auth").select("key, value").eq("account_id", accountId).in("key", keys.slice(i, i + 200));
          if (e) throw new Error(`Supabase: could not read WhatsApp keys: ${e.message}`);
          for (const row of data || []) {
            let value = decode(row.value);
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[(row.key as string).slice(type.length + 1)] = value;
          }
        }
        return out;
      },
      set: async (data) => {
        const upserts: { account_id: string; key: string; value: unknown }[] = [];
        const deletes: string[] = [];
        for (const category in data) {
          const entries = data[category as keyof typeof data] || {};
          for (const id in entries) {
            const value = entries[id];
            const key = `${category}-${id}`;
            if (value) upserts.push({ account_id: accountId, key, value: encode(value) });
            else deletes.push(key);
          }
        }
        for (let i = 0; i < upserts.length; i += 500) {
          const { error: e } = await sb().from("wa_auth").upsert(upserts.slice(i, i + 500), { onConflict: "account_id,key" });
          if (e) throw new Error(`Supabase: could not save WhatsApp keys: ${e.message}`);
        }
        for (let i = 0; i < deletes.length; i += 200) {
          await sb().from("wa_auth").delete().eq("account_id", accountId).in("key", deletes.slice(i, i + 200));
        }
      },
    },
  };

  const saveCreds = async () => {
    const { error: e } = await sb().from("wa_auth").upsert({ account_id: accountId, key: "creds", value: encode(state.creds) }, { onConflict: "account_id,key" });
    if (e) console.error("[whatsapp] could not save session", e.message);
  };

  return { state, saveCreds };
}

/** Forget a number's session (after it was unlinked from the phone). */
export async function clearAuthState(accountId: string) {
  await sb().from("wa_auth").delete().eq("account_id", accountId);
}
