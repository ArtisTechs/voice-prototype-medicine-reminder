import { z } from 'zod';

const email = z.string().trim().min(1, 'Enter your email address.').email('That email address does not look right.');

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});
export type SignInValues = z.infer<typeof signInSchema>;

export const signUpSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name.').max(80, 'Use 80 characters or fewer.'),
    email,
    password: z.string().min(8, 'Use at least 8 characters.').max(128, 'Use 128 characters or fewer.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'The passwords do not match.' });
export type SignUpValues = z.infer<typeof signUpSchema>;
