import { useEffect, useState } from "react";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const gradientByIndex = [
  "from-primary-500 to-accent-500",
  "from-accent-500 to-primary-600",
  "from-primary-600 to-accent-700",
  "from-accent-600 to-primary-500",
];

export function Avatar({
  src,
  name,
  size = "md",
  className = "",
}: {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    setFailed(false);
    setSeed((s) => s + 1);
  }, [src]);

  const sizes: Record<string, string> = {
    sm: "w-6 h-6 text-[10px]",
    md: "w-9 h-9 text-xs",
    lg: "w-12 h-12 text-sm",
    xl: "w-20 h-20 text-xl",
  };

  const showImage = src && !failed && seed > 0;

  return (
    <div
      className={`relative shrink-0 rounded-full overflow-hidden bg-gradient-to-br ${
        gradientByIndex[(seed + name.length) % gradientByIndex.length]
      } ${sizes[size]} ${className}`}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="w-full h-full flex items-center justify-center font-semibold text-white select-none">
          {initials(name)}
        </span>
      )}
    </div>
  );
}