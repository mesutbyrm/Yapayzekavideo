import { api, ok } from "@/lib/api";
export const GET = api(async ({ user }) => ok({ user }));
