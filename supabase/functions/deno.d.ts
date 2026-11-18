// Ambient types so VS Code's TypeScript server and `tsc` recognize
// Supabase Edge Function (Deno) globals and the `npm:` import specifier.

declare module 'npm:@supabase/supabase-js@2' {
  export const createClient: typeof import('@supabase/supabase-js').createClient
}

declare const Deno: {
  env: {
    get(key: string): string | undefined
    toObject(): Record<string, string>
  }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
