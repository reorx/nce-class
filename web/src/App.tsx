import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api, type Me } from './lib/api';
import { ClassDetail } from './pages/ClassDetail';
import { ClassList } from './pages/ClassList';
import { Teachers } from './pages/Teachers';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => {});
  }, []);
  return (
    <Routes>
      <Route path="/" element={<ClassList me={me} />} />
      <Route path="/classes/:id" element={<ClassDetail me={me} />} />
      <Route path="/teachers" element={<Teachers me={me} />} />
    </Routes>
  );
}
