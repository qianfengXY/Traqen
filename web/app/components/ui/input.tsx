import { forwardRef, type InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ label, className = "", ...rest }, ref) {
    return (
      <div className="form-row">
        {label ? <label className="label">{label}</label> : null}
        <input ref={ref} className={`input ${className}`} {...rest} />
      </div>
    );
  }
);
