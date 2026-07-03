// The single text primitive. Every string should render through this so type and
// colour come from tokens — not the 218 hand-typed `fontSize` literals (15 distinct
// values) the audit found. `variant` selects a role from the type scale; `color`
// a role token. Anything else (numberOfLines, onPress, accessibility) passes through.
import { Text as RNText, type TextProps, type StyleProp, type TextStyle } from 'react-native';
import { typography, colors, type TypeVariant } from '../../theme';

type ColorToken = keyof typeof colors;

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  color?: ColorToken;
  style?: StyleProp<TextStyle>;
};

export function Text({ variant = 'body', color = 'textPrimary', style, ...rest }: AppTextProps) {
  return <RNText style={[typography[variant], { color: colors[color] }, style]} {...rest} />;
}

export default Text;
