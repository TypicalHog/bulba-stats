import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0b0f14",
          color: "#e6edf3",
          padding: 80,
        }}
      >
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>
          BulbaStats
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 24,
            fontSize: 32,
            color: "#9baab9",
          }}
        >
          BulbaStore market analytics
        </div>
      </div>
    ),
    { ...size },
  );
}
