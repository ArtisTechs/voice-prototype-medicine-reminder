import { Text, type TextProps } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { type, type TypeVariant } from '../theme/tokens';

type Props = TextProps & { variant?: TypeVariant; muted?: boolean; color?: string };

/** The only text component screens use. Font scaling stays on (ui-ux rule). */
export function AppText({ variant = 'body', muted, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  const isHeader = variant === 'headline' || variant === 'display' || variant === 'title';
  return (
    <Text
      accessibilityRole={isHeader ? 'header' : undefined}
      {...rest}
      style={[type[variant], { color: color ?? (muted ? colors.textMuted : colors.text) }, style]}
    />
  );
}
