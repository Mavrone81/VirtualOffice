import * as React from "react";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-muted-2 focus:border-action focus:outline-none focus:ring-2 focus:ring-action/20 ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";
