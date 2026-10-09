import { FileUp, Plus, Trash2 } from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/hooks/use-theme";

const EMPTY_PROPERTIES: Record<string, JsonSchema> = {};

export type PluginRunArgs = Record<string, unknown>;

export type JsonSchema = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaType(schema: JsonSchema): string | undefined {
  const type = schema.type;
  return typeof type === "string" ? type : undefined;
}

function schemaProperties(schema: JsonSchema): Record<string, JsonSchema> {
  const properties = schema.properties;
  return isObject(properties)
    ? (properties as Record<string, JsonSchema>)
    : EMPTY_PROPERTIES;
}

function requiredList(schema: JsonSchema): string[] {
  const required = schema.required;
  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === "string")
    : [];
}

function schemaEnum(schema: JsonSchema): string[] | undefined {
  const values = schema.enum;
  if (!Array.isArray(values)) return undefined;
  return values.filter((item): item is string => typeof item === "string");
}

function schemaTitle(schema: JsonSchema, fallback: string): string {
  const title = schema.title;
  return typeof title === "string" && title.trim() ? title : fallback;
}

function schemaDescription(schema: JsonSchema): string | undefined {
  const description = schema.description;
  return typeof description === "string" && description.trim()
    ? description
    : undefined;
}

function displayName(name: string): string {
  return name.replace(/[_-]+/g, " ").trim() || name;
}

/**
 * Serializes the form's intermediate value into args suitable for a plugin
 * tool/action: strips empty strings and converts numerics (schema types) so
 * the JS plugin receives real numbers/booleans instead of raw text.
 */
export function serializePluginArgs(
  schema: JsonSchema | undefined,
  value: PluginRunArgs,
): PluginRunArgs {
  const properties = schemaProperties(schema ?? {});
  const out: PluginRunArgs = {};

  for (const [name, fieldSchema] of Object.entries(properties)) {
    const raw = value[name];
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "string" && raw === "") continue;

    switch (schemaType(fieldSchema)) {
      case "integer":
      case "number": {
        const parsed = Number(raw);
        out[name] = Number.isFinite(parsed) ? parsed : raw;
        break;
      }
      case "object":
        out[name] = serializePluginArgs(fieldSchema, isObject(raw) ? raw : {});
        break;
      case "array": {
        const items = isObject(fieldSchema.items)
          ? (fieldSchema.items as JsonSchema)
          : {};
        if (Array.isArray(raw)) {
          out[name] =
            schemaType(items) === "object"
              ? raw.map((item) =>
                  serializePluginArgs(items, isObject(item) ? item : {}),
                )
              : raw;
        }
        break;
      }
      default:
        out[name] = raw;
        break;
    }
  }

  return out;
}

function isSchemaObject(schema: JsonSchema): boolean {
  return schemaType(schema) === "object" || isObject(schema.properties);
}

function isSchemaArray(schema: JsonSchema): boolean {
  return schemaType(schema) === "array" || isObject(schema.items);
}

function isSchemaBoolean(schema: JsonSchema): boolean {
  return schemaType(schema) === "boolean";
}

function isSchemaNumber(schema: JsonSchema): boolean {
  return schemaType(schema) === "integer" || schemaType(schema) === "number";
}

export function PluginCapabilityForm({
  disabled = false,
  onChange,
  schema,
  value,
}: {
  disabled?: boolean;
  onChange: (value: PluginRunArgs) => void;
  schema: JsonSchema | undefined;
  value: PluginRunArgs;
}) {
  const properties = schemaProperties(schema ?? {});
  const required = requiredList(schema ?? {});
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return null;
  }

  return (
    <View className="gap-sp-3">
      {entries.map(([name, fieldSchema]) => (
        <SchemaField
          fieldSchema={fieldSchema}
          key={name}
          label={schemaTitle(fieldSchema, displayName(name))}
          name={name}
          onChange={(next) => onChange({ ...value, [name]: next })}
          required={required.includes(name)}
          value={value[name]}
          disabled={disabled}
        />
      ))}
    </View>
  );
}

function SchemaField({
  disabled,
  fieldSchema,
  label,
  name,
  onChange,
  required,
  value,
}: {
  disabled: boolean;
  fieldSchema: JsonSchema;
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  required: boolean;
  value: unknown;
}) {
  const description = schemaDescription(fieldSchema);

  if (isSchemaObject(fieldSchema)) {
    return (
      <ObjectField
        description={description}
        disabled={disabled}
        label={label}
        name={name}
        onChange={onChange}
        required={required}
        schema={fieldSchema}
        value={value}
      />
    );
  }

  if (isSchemaArray(fieldSchema)) {
    return (
      <ArrayField
        description={description}
        disabled={disabled}
        label={label}
        name={name}
        onChange={onChange}
        required={required}
        schema={fieldSchema}
        value={value}
      />
    );
  }

  if (isSchemaBoolean(fieldSchema)) {
    return (
      <View className="flex-row items-center justify-between gap-sp-3">
        <View className="min-w-0 flex-1 gap-sp-0.5">
          <Label required={required}>{label}</Label>
          {description ? (
            <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
              {description}
            </Text>
          ) : null}
        </View>
        <Checkbox
          checked={value === true}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </View>
    );
  }

  const options = schemaEnum(fieldSchema);

  if (options && options.length > 0) {
    return (
      <EnumField
        description={description}
        disabled={disabled}
        label={label}
        name={name}
        onChange={onChange}
        options={options}
        required={required}
        value={value}
      />
    );
  }

  if (fieldSchema.format === "file" || fieldSchema.contentMediaType) {
    return (
      <FileField
        description={description}
        disabled={disabled}
        label={label}
        name={name}
        onChange={onChange}
        required={required}
        value={value}
      />
    );
  }

  return (
    <TextField
      description={description}
      disabled={disabled}
      keyboardType={isSchemaNumber(fieldSchema) ? "numeric" : "default"}
      label={label}
      name={name}
      onChange={onChange}
      required={required}
      value={value}
    />
  );
}

function FieldDescription({ description }: { description?: string }) {
  if (!description) return null;

  return (
    <Text className="font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark">
      {description}
    </Text>
  );
}

function ObjectField({
  description,
  disabled,
  label,
  name,
  onChange,
  required,
  schema,
  value,
}: {
  description?: string;
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  required: boolean;
  schema: JsonSchema;
  value: unknown;
}) {
  const current = isObject(value) ? value : {};

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      <FieldDescription description={description} />
      <View className="gap-sp-3 rounded-ui border border-border bg-secondary px-sp-3 py-sp-3 dark:border-border-dark dark:bg-secondary-dark">
        <PluginCapabilityForm
          disabled={disabled}
          onChange={(next) => onChange(next)}
          schema={schema}
          value={current}
        />
      </View>
    </View>
  );
}

function ArrayField({
  description,
  disabled,
  label,
  name,
  onChange,
  required,
  schema,
  value,
}: {
  description?: string;
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  required: boolean;
  schema: JsonSchema;
  value: unknown;
}) {
  const theme = useTheme();
  const items = isObject(schema.items) ? (schema.items as JsonSchema) : {};
  const itemObject = schemaType(items) === "object" || isObject(items.properties);
  const current = Array.isArray(value) ? value : [];

  const updateRow = (index: number, next: unknown) => {
    const nextRows = current.slice();
    nextRows[index] = next;
    onChange(nextRows);
  };

  const removeRow = (index: number) => {
    onChange(current.filter((_, itemIndex) => itemIndex !== index));
  };

  const addRow = () => {
    onChange([...current, itemObject ? {} : ""]);
  };

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      <FieldDescription description={description} />

      {current.length > 0 ? (
        <View className="gap-sp-2">
          {current.map((item, index) => (
            <View className="flex-row items-start gap-sp-2" key={`${name}-${index}`}>
              <View className="min-w-0 flex-1">
                {itemObject ? (
                  <View className="gap-sp-3 rounded-ui border border-border bg-secondary px-sp-3 py-sp-3 dark:border-border-dark dark:bg-secondary-dark">
                    <PluginCapabilityForm
                      disabled={disabled}
                      onChange={(next) => updateRow(index, next)}
                      schema={items}
                      value={isObject(item) ? item : {}}
                    />
                  </View>
                ) : isSchemaNumber(items) ? (
                  <Input
                    className="font-mono"
                    value={typeof item === "string" ? item : String(item ?? "")}
                    disabled={disabled}
                    keyboardType="numeric"
                    onChangeText={(text) => updateRow(index, text)}
                  />
                ) : (
                  <Input
                    value={typeof item === "string" ? item : String(item ?? "")}
                    disabled={disabled}
                    onChangeText={(text) => updateRow(index, text)}
                  />
                )}
              </View>
              <Button
                accessibilityLabel={`Remove ${label} item`}
                disabled={disabled}
                onPress={() => removeRow(index)}
                size="icon-xs"
                variant="ghost"
              >
                <Trash2 color={theme.destructive} size={14} />
              </Button>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <Button
          disabled={disabled}
          leftIcon={<Plus color={theme.text} size={14} />}
          onPress={addRow}
          size="sm"
          variant="outline"
        >
          Add item
        </Button>
      </View>
    </View>
  );
}

function TextField({
  description,
  disabled,
  keyboardType,
  label,
  name,
  onChange,
  required,
  value,
}: {
  description?: string;
  disabled: boolean;
  keyboardType?: "default" | "numeric";
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  required: boolean;
  value: unknown;
}) {
  const text = typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      <FieldDescription description={description} />
      <Input
        autoCapitalize="none"
        autoCorrect={false}
        disabled={disabled}
        keyboardType={keyboardType}
        multiline={false}
        onChangeText={onChange}
        placeholder={name}
        value={text}
      />
    </View>
  );
}

function EnumField({
  description,
  disabled,
  label,
  name,
  onChange,
  options,
  required,
  value,
}: {
  description?: string;
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  options: string[];
  required: boolean;
  value: unknown;
}) {
  const selected =
    typeof value === "string" && options.includes(value) ? value : undefined;

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      <FieldDescription description={description} />
      <Select disabled={disabled} value={selected} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} label={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </View>
  );
}

function FileField({
  description,
  disabled,
  label,
  name,
  onChange,
  required,
  value,
}: {
  description?: string;
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: unknown) => void;
  required: boolean;
  value: unknown;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (busy || disabled) return;

    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || result.assets.length === 0) return;

      const asset = result.assets[0]!;
      onChange({
        mimeType: asset.mimeType ?? "application/octet-stream",
        name: asset.name ?? name,
        size: asset.size ?? null,
        uri: asset.uri,
      });
    } finally {
      setBusy(false);
    }
  };

  const picked = isObject(value);

  return (
    <View className="gap-sp-2">
      <Label required={required}>{label}</Label>
      <FieldDescription description={description} />
      <View className="flex-row items-center gap-sp-2">
        <View className="min-w-0 flex-1">
          <Pressable
            accessibilityLabel={`Upload ${label}`}
            className="min-h-12 flex-row items-center gap-sp-2 rounded-ui border border-border bg-input px-sp-3 dark:border-border-dark dark:bg-input-dark"
            disabled={disabled}
            onPress={pick}
            style={({ pressed }) => (pressed ? { opacity: 0.86 } : null)}
          >
            <FileUp color={theme.textSecondary} size={16} />
            <Text
              className="flex-1 font-sans text-sm text-muted-foreground dark:text-muted-foreground-dark"
              numberOfLines={1}
            >
              {picked
                ? String((value as Record<string, unknown>).name ?? "File chosen")
                : busy
                  ? "Opening picker…"
                  : "Choose a file"}
            </Text>
          </Pressable>
        </View>
        {picked ? (
          <Button
            accessibilityLabel={`Clear ${label}`}
            disabled={disabled}
            onPress={() => onChange(undefined)}
            size="icon-xs"
            variant="ghost"
          >
            <Trash2 color={theme.destructive} size={14} />
          </Button>
        ) : null}
      </View>
    </View>
  );
}
