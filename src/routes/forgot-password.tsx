import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ArrowRight, CheckCircle2, ChevronLeft, Loader2, Mail, Zap } from "lucide-react";
import { requestPasswordReset } from "@/server/email-actions";

export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => {
    if (import.meta.env.VITE_DEMO_MODE === "true") throw redirect({ to: "/" })
  },
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // We call our server function which then calls Better Auth's internal API
      await requestPasswordReset({ data: email });
      setSent(true);
      toast.success("Reset link sent!");
    } catch (err: any) {
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-page bg-[#050505]">
        <div className="auth-orb auth-orb-1 opacity-20" />
        <div className="auth-container max-w-md">
          <div className="auth-card bg-zinc-900/50 border border-zinc-800 backdrop-blur-xl p-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="h-16 w-16 rounded-2xl bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-500" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-zinc-400 mb-8">
              We've sent a password reset link to <br/>
              <span className="text-white font-medium">{email}</span>
            </p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold h-12 rounded-xl transition-all"
            >
              Return to Login
            </button>
            <p className="text-sm text-zinc-500 mt-6">
              Didn't receive the email? Check your spam folder or{" "}
              <button onClick={() => setSent(false)} className="text-blue-500 hover:underline">try again</button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page bg-[#050505]">
      <div className="auth-orb auth-orb-1 opacity-20" />

      <div className="auth-container max-w-md">
        <div className="auth-logo mb-8">
          <div className="auth-logo-icon bg-purple-600 shadow-lg shadow-purple-600/20">
            <Zap className="auth-logo-svg text-white" />
          </div>
          <span className="auth-brand text-white">SparkFeed</span>
        </div>

        <div className="auth-card bg-zinc-900/50 border border-zinc-800 backdrop-blur-xl">
          <div className="auth-card-header">
            <h1 className="auth-title text-white">Forgot password?</h1>
            <p className="auth-subtitle text-zinc-400">No worries, we'll send you reset instructions.</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-xs text-red-400 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{error}</span>
              </div>
            )}

            <div className="auth-field">
              <label className="auth-label text-zinc-400">Email address</label>
              <div className="auth-input-wrapper border-zinc-800 bg-zinc-950/50 focus-within:border-purple-500/50 transition-all">
                <Mail className="auth-input-icon text-zinc-600" />
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input text-white placeholder:text-zinc-700"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              type="submit"
              className="auth-btn-primary bg-purple-600 hover:bg-purple-700 text-white font-bold h-12 shadow-lg shadow-purple-600/10 transition-all active:scale-[0.98]"
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending Link...</span>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <span>Send Reset Link</span>
                  <ArrowRight className="w-4 h-4" />
                </div>
              )}
            </button>
          </form>

          <div className="auth-footer mt-8 pt-6 border-t border-zinc-800/50">
            <Link to="/login" className="flex items-center justify-center gap-2 text-zinc-500 hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Login</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
