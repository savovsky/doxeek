import { createRoot } from 'react-dom/client';
import App from './components/App';

const rootEl = document.getElementById('root');
if (!(rootEl instanceof HTMLDivElement)) {
  throw new Error('Missing or invalid React #root element');
}

createRoot(rootEl).render(<App />);
