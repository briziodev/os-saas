import { Icon } from "@iconify/react";

export function AppIcon({ icon, size = 20, className = "", title, ...props }) {
  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      className={className}
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      role={title ? "img" : undefined}
      {...props}
    />
  );
}
