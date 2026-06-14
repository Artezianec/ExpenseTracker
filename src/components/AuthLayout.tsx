import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Wallet } from 'lucide-react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-white dark:bg-zinc-950 p-4 text-center relative overflow-hidden transition-colors duration-300">
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] bg-indigo-600/10 dark:bg-indigo-600/20 rounded-full blur-[120px]" />
        <div className="absolute -bottom-1/4 -right-1/4 w-[80%] h-[80%] bg-fuchsia-600/10 dark:bg-fuchsia-600/20 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-zinc-50/50 dark:bg-white/5 backdrop-blur-2xl p-8 sm:p-12 rounded-[48px] shadow-2xl border border-zinc-200 dark:border-white/10 relative z-10"
      >
        <Link to="/" className="inline-block">
          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-gradient-to-br from-indigo-500 to-fuchsia-500 rounded-[32px] flex items-center justify-center mx-auto mb-8 sm:mb-10 shadow-2xl shadow-indigo-500/20">
            <Wallet className="w-10 h-10 sm:w-12 sm:h-12 text-white" />
          </div>
        </Link>

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3 text-zinc-900 dark:text-white font-display">
          {title}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mb-8 leading-relaxed text-base">
          {subtitle}
        </p>

        {children}

        {footer ? (
          <div className="mt-8 pt-6 border-t border-zinc-200 dark:border-white/10 text-sm text-zinc-500 dark:text-zinc-400">
            {footer}
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}
