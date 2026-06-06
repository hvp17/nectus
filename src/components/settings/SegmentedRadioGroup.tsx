import { FieldLegend, FieldSet } from "../ui/field";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";

export function SegmentedRadioGroup<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{label}</FieldLegend>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) onChange(nextValue as T);
        }}
        variant="outline"
        className="flex-wrap"
      >
        {options.map(([optionValue, optionLabel]) => (
          <ToggleGroupItem
            key={optionValue}
            value={optionValue}
            aria-label={`${name} ${optionLabel}`}
            className="min-h-8 px-3"
          >
            {optionLabel}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  );
}
