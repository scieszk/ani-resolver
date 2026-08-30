import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, X } from "lucide-react";

function classes(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export const EdgeSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function EdgeSurface({ className, onPointerMove, onPointerLeave, ...props }, ref) {
    return (
      <div
        {...props}
        ref={ref}
        className={classes("edge-surface", className)}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty("--edge-x", `${event.clientX - bounds.left}px`);
          event.currentTarget.style.setProperty("--edge-y", `${event.clientY - bounds.top}px`);
          onPointerMove?.(event);
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.removeProperty("--edge-x");
          event.currentTarget.style.removeProperty("--edge-y");
          onPointerLeave?.(event);
        }}
      />
    );
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    iconBefore,
    iconAfter,
    loading = false,
    children,
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      className={classes("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)}
      disabled={disabled || loading}
    >
      {iconBefore && <span className="ui-button-icon">{iconBefore}</span>}
      <span>{children}</span>
      {iconAfter && <span className="ui-button-icon">{iconAfter}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonProps["variant"];
  size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, variant = "quiet", size = "md", children, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      aria-label={label}
      className={classes("ui-icon-button", `ui-icon-button-${size}`, `ui-button-${variant}`, className)}
    >
      {children}
    </button>
  );
});

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="ui-tooltip" sideOffset={8}>
            {content}
            <TooltipPrimitive.Arrow className="ui-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  closeLabel,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  closeLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-overlay" />
        <DialogPrimitive.Content className={classes("ui-dialog", className)}>
          <div className="ui-dialog-heading">
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton label={closeLabel} size="sm"><X size={17} /></IconButton>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  label,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: ReactNode;
  className?: string;
}) {
  return (
    <label className={classes("ui-checkbox-row", className, disabled && "is-disabled")}>
      <CheckboxPrimitive.Root
        className="ui-checkbox"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
      >
        <CheckboxPrimitive.Indicator><Check size={14} /></CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label}
    </label>
  );
}

export function SegmentedControl({
  value,
  options,
  onValueChange,
  label,
  className,
}: {
  value: string;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={classes("ui-segmented", className)} role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={value === option.value ? "is-selected" : ""}
          onClick={() => onValueChange(option.value)}
        >
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}

interface FieldBaseProps {
  label: string;
  startAdornment?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldBaseProps>(
  function TextField({ label, startAdornment, className, id, ...props }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <label className={classes("ui-field", className)} htmlFor={fieldId}>
        <span className="ui-field-label">{label}</span>
        <span className="ui-field-control">
          {startAdornment && <span className="ui-field-adornment">{startAdornment}</span>}
          <input {...props} id={fieldId} ref={ref} />
        </span>
      </label>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldBaseProps>(
  function TextArea({ label, className, id, ...props }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    return (
      <label className={classes("ui-field", className)} htmlFor={fieldId}>
        <span className="ui-field-label">{label}</span>
        <span className="ui-field-control"><textarea {...props} id={fieldId} ref={ref} /></span>
      </label>
    );
  },
);

export function SelectField({
  label,
  options,
  onValueChange,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  const generated = useId();
  const fieldId = props.id ?? generated;
  return (
    <label className={classes("ui-field", className)} htmlFor={fieldId}>
      <span className="ui-field-label">{label}</span>
      <span className="ui-field-control">
        <select {...props} id={fieldId} onChange={(event) => onValueChange(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </span>
    </label>
  );
}

export function Chip({
  children,
  onDelete,
  deleteLabel,
  icon,
}: {
  children: ReactNode;
  onDelete?: () => void;
  deleteLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <span className="ui-chip">
      {icon}<span className="ui-chip-label">{children}</span>
      {onDelete && <button type="button" aria-label={deleteLabel ?? "Remove"} onClick={onDelete}><X size={13} /></button>}
    </span>
  );
}

export function MobileDock({ children, label }: { children: ReactNode; label: string }) {
  return <EdgeSurface className="mobile-dock" role="navigation" aria-label={label}>{children}</EdgeSurface>;
}

export function NavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}<span>{label}</span>
    </button>
  );
}
