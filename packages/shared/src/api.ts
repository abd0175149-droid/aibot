import { z } from 'zod';

export const Role = z.enum(['platform_owner', 'tenant_owner', 'tenant_agent']);
export type Role = z.infer<typeof Role>;

export const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const SendMessageBody = z.object({
  text: z.string().min(1).max(4096).optional(),
  choices: z.object({
    body: z.string().min(1),
    options: z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(13),
  }).optional(),
}).refine((v) => !!v.text || !!v.choices, { message: 'text أو choices مطلوب' });

export const HealthResponse = z.object({
  service: z.literal('aibot'),
  rev: z.string(),
  db: z.boolean(),
  redis: z.boolean(),
  queues: z.record(z.number()).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
