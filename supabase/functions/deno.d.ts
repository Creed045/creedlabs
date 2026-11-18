// Ambient types so VS Code's built-in TypeScript server & tsc understand
// Supabase Edge Function (Deno) globals and the npm: specifier.

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined
    toObject(): Record<string, string>
  }
  export const env: Env
  export function serve(
    handler: (req: Request) => Response | Promise<Response>,
  ): void
}
