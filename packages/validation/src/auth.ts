import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.')),
  // Length-capped so a huge body cannot be used to burn CPU in the password hash.
  password: z.string().min(1, 'Enter your password.').max(256),
});

export type LoginInput = z.output<typeof loginSchema>;
