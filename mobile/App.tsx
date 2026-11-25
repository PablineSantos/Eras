import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import EraGame from './components/EraGame';

export default function App() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar hidden />
      <EraGame
        dom={{
          scrollEnabled: false,
          bounces: false,
          overScrollMode: 'never',
          showsHorizontalScrollIndicator: false,
          showsVerticalScrollIndicator: false,
          allowsLinkPreview: false,
          hideKeyboardAccessoryView: true,
          automaticallyAdjustContentInsets: false,
          contentInsetAdjustmentBehavior: 'never',
          style: { flex: 1, backgroundColor: '#000' },
        }}
      />
    </View>
  );
}
