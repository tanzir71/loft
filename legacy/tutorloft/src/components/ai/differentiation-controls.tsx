type DifferentiationValues = {
  bloomLevel?: string;
  differentiationLevel?: string;
  readingLevel?: string;
  translateTo?: string;
  notes?: string;
};

type DifferentiationControlsProps = {
  defaultValues?: DifferentiationValues;
  idPrefix?: string;
};

export function DifferentiationControls({ defaultValues, idPrefix }: DifferentiationControlsProps) {
  const id = (value: string) => (idPrefix ? `${idPrefix}-${value}` : value);

  return (
    <fieldset className="grid gap-4 md:grid-cols-2">
      <legend className="sr-only">Differentiation controls</legend>
      <label className="block text-sm font-medium" htmlFor={id("differentiationLevel")}>
        Level
      </label>
      <select
        className="h-11 rounded-xl border bg-background px-3 text-sm"
        defaultValue={defaultValues?.differentiationLevel ?? "standard"}
        id={id("differentiationLevel")}
        name="differentiationLevel"
      >
        <option value="standard">Standard</option>
        <option value="support">Extra support</option>
        <option value="advanced">Advanced</option>
      </select>
      <label className="block text-sm font-medium" htmlFor={id("bloomLevel")}>
        Bloom level
      </label>
      <select
        className="h-11 rounded-xl border bg-background px-3 text-sm"
        defaultValue={defaultValues?.bloomLevel ?? "apply"}
        id={id("bloomLevel")}
        name="bloomLevel"
      >
        <option value="remember">Remember</option>
        <option value="understand">Understand</option>
        <option value="apply">Apply</option>
        <option value="analyze">Analyze</option>
        <option value="evaluate">Evaluate</option>
        <option value="create">Create</option>
      </select>
      <label className="block text-sm font-medium" htmlFor={id("readingLevel")}>
        Reading level
      </label>
      <select
        className="h-11 rounded-xl border bg-background px-3 text-sm"
        defaultValue={defaultValues?.readingLevel ?? "grade_level"}
        id={id("readingLevel")}
        name="readingLevel"
      >
        <option value="simple">Simpler</option>
        <option value="grade_level">Grade level</option>
        <option value="challenging">More challenging</option>
      </select>
      <label className="block text-sm font-medium" htmlFor={id("translateTo")}>
        Translate to
      </label>
      <input
        className="h-11 rounded-xl border bg-background px-3 text-sm"
        defaultValue={defaultValues?.translateTo ?? ""}
        id={id("translateTo")}
        name="translateTo"
        placeholder="Optional language"
      />
      <label className="block text-sm font-medium md:col-span-2" htmlFor={id("differentiationNotes")}>
        Custom instruction
      </label>
      <textarea
        className="min-h-24 rounded-xl border bg-background px-3 py-2 text-sm md:col-span-2"
        defaultValue={defaultValues?.notes ?? ""}
        id={id("differentiationNotes")}
        name="differentiationNotes"
      />
    </fieldset>
  );
}
