export class InputError extends Error {}
export function text(
  value: unknown,
  label: string,
  max = 160,
  required = true,
): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    throw new InputError(`${label}: valor inválido.`);
  }
  const result = value.trim();
  if ((required && !result) || result.length > max)
    throw new InputError(
      `${label}: completá un valor de hasta ${max} caracteres.`,
    );
  return result;
}
export function id(value: unknown): number {
  const v = String(value);
  if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v)))
    throw new InputError("Identificador inválido.");
  return Number(v);
}
export function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(String(value)))
    throw new InputError(`${label}: ingresá un número entero.`);
  const n = Number(value);
  if (n < min || n > max)
    throw new InputError(`${label}: debe estar entre ${min} y ${max}.`);
  return n;
}
export function cents(value: unknown): number {
  const v = String(value).trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(v))
    throw new InputError("Importe inválido: usá hasta dos decimales.");
  const [whole, fraction = ""] = v.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function email(value: unknown, required = true): string {
  const v = text(value, "Correo", 254, required).toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    throw new InputError("Correo electrónico inválido.");
  return v;
}
export function date(value: unknown): string {
  const v = String(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new InputError("Fecha inválida.");
  return v;
}
export function option(value: unknown, allowed: readonly string[]): string {
  const v = String(value);
  if (!allowed.includes(v)) throw new InputError("Opción inválida.");
  return v;
}
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function nextBillingMonth(day: string): string {
  const d = new Date(date(day) + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}
export function discounted(amount: number, percent: number): number {
  return Math.round((amount * (100 - percent)) / 100);
}
export function dueDate(period: string, day: number): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new InputError("Período inválido.");
  const [year, month] = period.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
export function money(value: unknown): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
  }).format(Number(value) / 100);
}
