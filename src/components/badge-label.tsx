import { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// Same layout as the web badge (lib/badge-print.ts): 4in x 2in label at 203 dpi.
// Sizes below are in printer dots; `width` (dp on screen) sets the scale.
// Every Text disables font scaling: the label is captured at a fixed dot
// size and must not follow the device's accessibility font size.
export const BADGE_DOTS = { width: 812, height: 406 } as const;

export interface BadgeLabelProps {
  fullName: string;
  logoText: string;
  link?: string;
  width: number;
}

export const BadgeLabel = forwardRef<View, BadgeLabelProps>(function BadgeLabel(
  { fullName, logoText, link, width },
  ref,
) {
  const s = width / BADGE_DOTS.width;
  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.badge, { width, height: BADGE_DOTS.height * s, paddingVertical: 24 * s, paddingHorizontal: 32 * s }]}
    >
      <View style={[styles.info, { paddingRight: 40 * s }]}>
        <Text allowFontScaling={false} style={[styles.logo, { fontSize: 28 * s, letterSpacing: 2.8 * s }]}>{logoText.toUpperCase()}</Text>
        <View>
          <Text allowFontScaling={false} numberOfLines={2} style={[styles.name, { fontSize: 50 * s, lineHeight: 55 * s, maxWidth: 480 * s }]}>
            {fullName.toUpperCase()}
          </Text>
          <View style={[styles.separator, { height: 6 * s, width: 120 * s, marginVertical: 24 * s }]} />
          {link ? (
            <Text allowFontScaling={false} numberOfLines={2} style={[styles.link, { fontSize: 21 * s, maxWidth: 480 * s }]}>
              {link}
            </Text>
          ) : null}
        </View>
      </View>
      <QRCode value={link || 'https://hubcommunity.io'} size={256 * s} ecl="H" />
    </View>
  );
});

const styles = StyleSheet.create({
  badge: { backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  info: { flex: 1, height: '100%', justifyContent: 'space-around' },
  logo: { color: '#000', fontWeight: '800' },
  name: { color: '#000', fontWeight: '900' },
  separator: { backgroundColor: '#000' },
  link: { color: '#000', fontWeight: '600' },
});
