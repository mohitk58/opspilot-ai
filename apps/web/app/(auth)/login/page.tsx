'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { LoginDto } from '@opspilot/types';
import { FormError, SubmitButton, TextField } from '@/components/form';
import { ApiError } from '@/lib/api';
import { login } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginDto>({ resolver: zodResolver(LoginDto) });

  const onSubmit = handleSubmit(async (dto) => {
    setServerError(null);
    try {
      await login(dto);
      router.replace('/dashboard');
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 401
          ? 'Invalid email or password.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Is the API running?',
      );
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Sign in to OpsPilot</h1>
        <p className="mt-1 text-sm text-slate-400">
          New here?{' '}
          <Link href="/signup" className="text-emerald-400 hover:underline">
            Create an account
          </Link>
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          registration={register('email')}
          error={errors.email}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          registration={register('password')}
          error={errors.password}
        />
        <FormError message={serverError} />
        <SubmitButton pending={isSubmitting}>Sign in</SubmitButton>
      </form>
    </main>
  );
}
