import * as React from "react";

export function Label({ className = "", ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-1.5 block text-[13px] font-medium text-ink ${className}`} {...props} />;
}
