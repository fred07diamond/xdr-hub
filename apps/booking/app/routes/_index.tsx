import { Navigate } from "react-router";

export function meta() {
  return [{ title: "XDR Booking Agent" }];
}

export default function Index() {
  return <Navigate to="/meetings" replace />;
}
