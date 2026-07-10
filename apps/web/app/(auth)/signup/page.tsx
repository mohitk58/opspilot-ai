'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { SignupDto } from '@opspilot/types';
import { FormError, SubmitButton, TextField } from '@/components/form';
import { ApiError } from '@/lib/api';
import { signup } from '@/lib/auth';

export default function SignupPage() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupDto>({ resolver: zodResolver(SignupDto) });

  const onSubmit = handleSubmit(async (dto) => {
    setServerError(null);
    try {
      await signup(dto);
      router.replace('/dashboard');
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 409
          ? 'An account with this email already exists.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Is the API running?',
      );
    }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="mt-1 text-sm text-slate-400">
          Already have one?{' '}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <TextField
          label="Full name"
          autoComplete="name"
          registration={register('fullName')}
          error={errors.fullName}
        />
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
          autoComplete="new-password"
          registration={register('password')}
          error={errors.password}
        />
        <FormError message={serverError} />
        <SubmitButton pending={isSubmitting}>Create account</SubmitButton>
      </form>
    </main>
  );
}
