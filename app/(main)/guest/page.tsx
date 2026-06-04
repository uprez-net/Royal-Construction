import { Mail } from 'lucide-react';

export default function GuestPage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-8 text-center">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500/10 rounded-full mb-4">
              <Mail className="w-8 h-8 text-amber-500" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Access Pending</h1>
            <p className="text-slate-400">Your CRM access is being reviewed</p>
          </div>

          <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 mb-6">
            <p className="text-slate-300 text-sm leading-relaxed">
              We&apos;re reviewing your request for access to the CRM system. Please wait for approval from our team. This typically takes 1-2 business days.
            </p>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
            <p className="text-slate-300 text-sm mb-2">If you believe this is incorrect, please reach out to:</p>
            <a
              href="mailto:devloper@royalconstructions.com.au"
              className="inline-flex items-center justify-center gap-2 text-amber-500 hover:text-amber-400 font-medium transition-colors"
            >
              <Mail className="w-4 h-4" />
              devloper@royalconstructions.com.au
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
