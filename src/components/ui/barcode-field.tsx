import { ScanLine } from "lucide-react";
import { Input } from "./input";

export interface BarcodeFieldProps {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

export function BarcodeField({
  label,
  value,
  onValueChange,
  placeholder,
  disabled,
  autoFocus,
  id,
}: BarcodeFieldProps) {
  return (
    <Input
      id={id}
      label={label}
      icon={<ScanLine className="size-4" />}
      dir="ltr"
      className="font-mono uppercase tracking-widest"
      placeholder={placeholder ?? "GYM-000000"}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value.toUpperCase())}
    />
  );
}
