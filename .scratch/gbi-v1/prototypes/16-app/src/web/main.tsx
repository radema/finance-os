import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/app.css';
import './styles/pages.css';
import { App } from './App.tsx';
import { StoreProvider } from './store.tsx';

createRoot(document.getElementById('root')!).render(<StoreProvider><App /></StoreProvider>);
