import { useEffect, useLayoutEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, LogOut, RotateCcw } from 'lucide-react';
import logo from '@/assets/logo.png';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { markPortalShellHidden, markPortalShellVisible } from '@/lib/portalPerformance';
import { cn } from '@/lib/utils';

type AuthenticatedShellSkeletonProps = {
  status?: 'checking-session' | 'hydrating-access' | 'route-loading' | 'error';
  errorMessage?: string | null;
  onRetry?: () => void;
  onSignOut?: () => void;
};

const SkeletonLine = ({ className }: { className?: string }) => (
  <span
    className={cn('block animate-pulse rounded-full bg-muted motion-reduce:animate-none', className)}
    aria-hidden="true"
  />
);

export function AuthenticatedShellSkeleton({
  status = 'hydrating-access',
  errorMessage,
  onRetry,
  onSignOut,
}: AuthenticatedShellSkeletonProps) {
  const { language } = useLanguage();
  const [isStalled, setIsStalled] = useState(false);
  const [retryCycle, setRetryCycle] = useState(0);
  const isError = status === 'error';
  const isChinese = language === 'zh-Hans';
  const copy = isChinese
    ? {
        checking: '正在检查您的安全会话…',
        hydrating: '正在准备您的工作区…',
        routeLoading: '正在打开您的工作区…',
        error: '无法完成工作区加载。',
        stalled: '仍在安全地检查您的访问权限…',
        loadingDescription: '正在确认您的帐户访问权限。准备完成后才会显示导航。',
        stalledDescription: '这比平时花费更长时间。您可以退出登录后再试一次。',
        errorDescription: '您的帐户仍然安全。请重试安全访问检查或退出登录。',
        retry: '重试',
        signOut: '退出登录',
        workspaceLoading: '工作区内容正在加载',
      }
    : {
        checking: 'Checking your secure session…',
        hydrating: 'Preparing your workspace…',
        routeLoading: 'Opening your workspace…',
        error: 'We could not finish opening your workspace.',
        stalled: 'Still checking your access securely…',
        loadingDescription:
          'Your account access is being confirmed. Navigation will appear only after it is ready.',
        stalledDescription:
          'This is taking longer than usual. You can sign out and try again.',
        errorDescription:
          'Your account is safe. Retry the secure access check or sign out.',
        retry: 'Retry',
        signOut: 'Sign out',
        workspaceLoading: 'Workspace content is loading',
      };
  const baseStatusMessage =
    status === 'checking-session'
      ? copy.checking
      : status === 'route-loading'
        ? copy.routeLoading
        : isError
          ? copy.error
          : copy.hydrating;
  const statusMessage = isStalled ? copy.stalled : baseStatusMessage;
  const statusDescription = isError
    ? errorMessage ?? copy.errorDescription
    : isStalled
      ? copy.stalledDescription
      : copy.loadingDescription;

  useEffect(() => {
    setIsStalled(false);

    if (isError || status === 'route-loading') {
      return;
    }

    const timer = window.setTimeout(() => setIsStalled(true), 8_000);
    return () => window.clearTimeout(timer);
  }, [isError, retryCycle, status]);

  useLayoutEffect(() => {
    document.body.classList.add('app-surface');

    return () => {
      document.body.classList.remove('app-surface');
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(markPortalShellVisible);
    return () => {
      window.cancelAnimationFrame(frame);
      markPortalShellHidden();
    };
  }, []);

  return (
    <div className="app-surface min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-[hsl(var(--app-shell-divider))] bg-sidebar/80 lg:flex lg:min-h-screen lg:flex-col">
        <div
          className="app-shell-header-row flex min-h-[4.25rem] items-center gap-3 px-4 lg:min-h-0"
          data-app-shell-sidebar-header
        >
          <img
            src={logo}
            alt="Bloomjoy Sweets"
            width={40}
            height={40}
            decoding="async"
            className="h-10 w-10 shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine className="h-2.5 w-24" />
            <SkeletonLine className="h-3.5 w-32" />
          </div>
        </div>
        <div className="space-y-6 px-4 py-6" aria-hidden="true">
          {[0, 1].map((section) => (
            <div className="space-y-3" key={section}>
              <SkeletonLine className="h-2.5 w-16" />
              {[0, 1, 2].map((item) => (
                <div className="flex min-h-10 items-center gap-3 rounded-lg px-2" key={item}>
                  <span className="h-8 w-8 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                  <SkeletonLine className={cn('h-3', item === 1 ? 'w-24' : 'w-28')} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <div className="min-w-0">
        <header
          className="app-shell-header-row flex min-h-[4.25rem] items-center bg-background/95 px-4 sm:px-6 lg:min-h-0"
          data-app-shell-content-header
        >
          <div className="flex w-full items-center gap-3">
            <img
              src={logo}
              alt=""
              width={36}
              height={36}
              decoding="async"
              className="h-9 w-9 shrink-0 lg:hidden"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonLine className="h-2.5 w-24" />
              <SkeletonLine className="h-4 w-36 sm:w-48" />
            </div>
            <SkeletonLine className="h-11 w-11 sm:h-9 sm:w-24" />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
          <div
            className={cn(
              'rounded-2xl border p-5 shadow-sm sm:p-7',
              isError ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card'
            )}
          >
            <div className="flex items-start gap-3">
              {isError ? (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              ) : (
                <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
              )}
              <div className="min-w-0 flex-1">
                <div role="status" aria-live="polite" aria-atomic="true">
                  <p className="font-display text-lg font-semibold text-foreground">
                    {statusMessage}
                  </p>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                    {statusDescription}
                  </p>
                </div>
                {(isError || isStalled) && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {isError && onRetry && (
                      <Button
                        type="button"
                        className="min-h-11"
                        onClick={() => {
                          setIsStalled(false);
                          setRetryCycle((cycle) => cycle + 1);
                          onRetry();
                        }}
                      >
                        <RotateCcw className="h-4 w-4" />
                        {copy.retry}
                      </Button>
                    )}
                    {onSignOut && (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        onClick={onSignOut}
                      >
                        <LogOut className="h-4 w-4" />
                        {copy.signOut}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {!isError && (
              <section
                className="mt-7"
                role="region"
                aria-label={copy.workspaceLoading}
                aria-busy="true"
              >
                <div
                  className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.8fr)]"
                  aria-hidden="true"
                >
                <div className="rounded-xl border border-border/70 p-5">
                  <SkeletonLine className="h-3 w-28" />
                  <SkeletonLine className="mt-4 h-6 w-52 max-w-full" />
                  <SkeletonLine className="mt-3 h-3 w-full max-w-lg" />
                  <SkeletonLine className="mt-2 h-3 w-4/5 max-w-md" />
                  <SkeletonLine className="mt-6 h-10 w-32 rounded-lg" />
                </div>
                <div className="space-y-4">
                  {[0, 1].map((item) => (
                    <div className="rounded-xl border border-border/70 p-5" key={item}>
                      <SkeletonLine className="h-3 w-24" />
                      <SkeletonLine className="mt-4 h-5 w-40" />
                      <SkeletonLine className="mt-3 h-3 w-full" />
                    </div>
                  ))}
                </div>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
