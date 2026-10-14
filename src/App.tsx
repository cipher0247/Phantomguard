import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, RequireAuth } from './auth';
import { Intro, shouldShowIntro } from './Intro';
import { Shell } from './ui';
import { SignIn } from './pages/SignIn';
import { Home } from './pages/Home';
import { Analyze } from './pages/Analyze';
import { Alerts } from './pages/Alerts';
import { Activity } from './pages/Activity';
import { Advisor } from './pages/Advisor';
import { Profile } from './pages/Profile';

export function App() {
  // The app mounts underneath the intro so session check and first paint finish while the video plays.
  const [intro, setIntro] = useState(shouldShowIntro);
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<Home />} />
          <Route path="analyze" element={<Analyze />} />
          <Route path="alerts" element={<Alerts />} />
          <Route path="activity" element={<Activity />} />
          <Route path="advisor" element={<Advisor />} />
          <Route path="profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {intro && <Intro onDone={() => setIntro(false)} />}
    </AuthProvider>
  );
}
