import React from "react";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className = "", ...props }: SkeletonProps) {
  return (
    <div
      className={`relative overflow-hidden bg-surface-200/70 rounded-lg ${className}`}
      {...props}
    >
      <div className="absolute inset-0 animate-shimmer" />
    </div>
  );
}

// Custom Document Skeleton
export function DocumentSkeleton() {
  return (
    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-100 bg-white">
      <div className="flex items-start gap-3.5 min-w-0 flex-1">
        <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
        <div className="space-y-2 flex-1 max-w-md">
          <Skeleton className="h-4 w-3/4 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24 rounded-sm" />
            <Skeleton className="h-3 w-16 rounded-sm" />
          </div>
          <div className="flex gap-1.5 pt-1">
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-4 w-16 rounded-md" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

// Custom Group Card Skeleton
export function GroupSkeleton() {
  return (
    <div className="p-4 bg-white rounded-xl border border-surface-200 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton className="h-4 w-1/2 rounded-md" />
        <Skeleton className="h-4 w-14 rounded-full" />
      </div>
      <Skeleton className="h-3 w-1/3 rounded-sm" />
    </div>
  );
}

// Custom Staff Row Skeleton
export function StaffSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-xl border border-surface-200">
      <Skeleton className="w-10 h-10 rounded-full shrink-0" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-36 rounded-md" />
        <Skeleton className="h-3 w-48 rounded-sm" />
      </div>
      <Skeleton className="h-5 w-20 rounded-full" />
    </div>
  );
}
