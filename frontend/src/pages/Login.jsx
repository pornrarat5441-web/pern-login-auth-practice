import React, { useState } from "react";
import axios from "axios";

const Login = () => {
  const [form, setForm] = useState({
    email: "",
    password: ""
  })
  const [error, setError] = useState("");

  function handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:5001/api/auth/login", form);
    } catch (err) {
      setError("Invalid email or password");
    }
  }

  return <div>
    <form>
      <h2>Login</h2>
      <input type="email" placeholder="email" className="border p-2 w-full mb-3" 
      value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} />
      <input type="password" placeholder="password" className="border p-2 w-full mb-3" 
      value={form.password} onChange={(e) => setForm({...form, password: e.target.value})} />
      <button className="bg-blue-500 text-white p-2 w-full">Login</button>
    </form>
  </div>
};

export default Login;