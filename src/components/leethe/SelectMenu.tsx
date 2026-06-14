type Option = {
  value: string | number;
  label: string | number;
};

type SelectMenuProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Option[];
  ariaLabel?: string;
};

export function SelectMenu({ label, value, onChange, options, ariaLabel }: SelectMenuProps) {
  return (
    <label className="stream-menu w-full focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[oklch(0.62_0.1_245/0.75)]">
      {label ? <span>{label}</span> : null}
      <select
        aria-label={ariaLabel || label || "Select option"}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
