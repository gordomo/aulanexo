import type { Response } from "express";
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  value?: any;
  options?: { value: any; label: string }[];
  min?: string;
  max?: string;
  step?: string;
  hint?: string;
};
export type Action = {
  label: string;
  href?: string;
  action?: string;
  confirm?: string;
  values?: Record<string, any>;
};
export function page(
  res: Response,
  title: string,
  columns: string[],
  items: any[][],
  options: Record<string, any> = {},
) {
  res.render("list", { title, columns, items, actions: [], ...options });
}
export function form(
  res: Response,
  title: string,
  fields: Field[],
  options: Record<string, any> = {},
) {
  res.render("form", {
    title,
    fields,
    button: "Guardar",
    description: "",
    ...options,
  });
}
export const roles = [
  { value: "admin", label: "Administrador" },
  { value: "teacher", label: "Profesor" },
  { value: "student", label: "Alumno" },
];
export const roleLabel = (value: string) =>
  roles.find((r) => r.value === value)?.label ?? value;
