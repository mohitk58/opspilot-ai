'use client';

import type { InputHTMLAttributes } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
}

export function TextField({
  label,
  registration,
  error,
  ...props
}: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-slate-300">{label}</span>
      <input
        className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none transition-colors focus:border-emerald-500"
        {...props}
        {...registration}
      />
      {error && <span className="text-xs text-red-400">{error.message}</span>}
    </label>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-400"
    >
      {message}
    </p>
  );
}

export function SubmitButton({
  children,
  pending,
}: {
  children: React.ReactNode;
  pending: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-emerald-500 px-5 py-2.5 font-medium text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Please wait…' : children}
    </button>
  );
}
