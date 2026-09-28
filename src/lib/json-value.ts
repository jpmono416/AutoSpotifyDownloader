import type { JSONValue } from "postgres";
/** Normalize application values for postgres.json without double-encoding JSON. */
export function jsonValue(value: unknown): JSONValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Database JSON value must be serializable.");
  return JSON.parse(encoded) as JSONValue;
}
