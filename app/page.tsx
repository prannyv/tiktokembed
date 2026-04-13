export default function Home() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 py-12 text-center">
      <div className="max-w-lg w-full space-y-8">
        {/* Logo / Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-500 via-red-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-pink-500/30">
            <svg
              className="w-10 h-10 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.82a8.28 8.28 0 0 0 4.84 1.55V6.92a4.85 4.85 0 0 1-1.07-.23z" />
            </svg>
          </div>
        </div>

        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight">TikTok Embed</h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            Share TikTok videos that play inline in iMessage — no app required.
          </p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 text-left space-y-4">
          <h2 className="font-semibold text-white text-sm uppercase tracking-wider text-center">
            How to use
          </h2>
          <ol className="space-y-3 text-sm text-gray-300">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                1
              </span>
              <span>
                Copy a TikTok video URL from the app
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                2
              </span>
              <span>
                Replace <code className="bg-white/10 px-1.5 py-0.5 rounded text-white">tiktok.com</code> with{' '}
                <code className="bg-white/10 px-1.5 py-0.5 rounded text-white">{'{your domain}'}</code> in the URL
              </span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center flex-shrink-0 text-xs font-bold">
                3
              </span>
              <span>
                Share the rewritten link in iMessage — it will play inline
              </span>
            </li>
          </ol>
        </div>

        <p className="text-xs text-gray-600">
          Personal use only. Not affiliated with TikTok.
        </p>
      </div>
    </main>
  );
}
