from starlette.middleware.base import BaseHTTPMiddleware


class ForwardedProtoMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        forwarded_proto = request.headers.get("x-forwarded-proto")
        if forwarded_proto in {"http", "https"}:
            request.scope["scheme"] = forwarded_proto
        return await call_next(request)

