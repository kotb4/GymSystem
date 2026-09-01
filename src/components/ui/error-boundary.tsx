import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { useT } from "@/i18n";
import { Card, CardHeader } from "./card";
import { Button } from "./button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const t = useT();
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center px-6 py-10">
      <Card className="w-full">
        <CardHeader
          title={t("errors.unexpectedTitle")}
          description={t("errors.unexpectedDesc")}
        />
        <div className="space-y-4 px-5 pb-5">
          <div className="flex items-start gap-3 rounded-xl border border-red/30 bg-red/10 p-3.5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-red">{t("errors.unexpectedShort")}</p>
              <p dir="ltr" className="mt-1 break-all text-[12px] text-subtle font-mono">
                {error.name}: {error.message}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onReset}>
              <RotateCcw className="size-4" />
              {t("common.retry")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
