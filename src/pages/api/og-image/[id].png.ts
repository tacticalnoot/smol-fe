import type { APIRoute } from 'astro';

/**
 * Generates a 2:1 social preview image from a 1:1 album cover
 * by adding letterbox/pillarbox padding
 */
export const GET: APIRoute = async ({ params, request }) => {
  const { id } = params;

  if (!id) {
    return new Response('Missing image ID', { status: 400 });
  }

  const API_URL = import.meta.env.PUBLIC_API_URL || 'https://api.smol.xyz';
  const scale = new URL(request.url).searchParams.get('scale') || '16';

  // Fetch the original 1:1 image
  const imageUrl = `${API_URL}/image/${id}.png?scale=${scale}`;

  try {
    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      return new Response('Image not found', { status: 404 });
    }

    // For Cloudflare Workers, use the cf property to resize/pad the image
    // This uses Cloudflare's Image Resizing feature
    const resizedResponse = await fetch(imageUrl, {
      cf: {
        image: {
          width: 1200,
          height: 630,
          fit: 'pad',
          background: '#000000', // Black letterbox bars
        }
      }
    });

    if (!resizedResponse.ok) {
      // Fallback: just return the original image
      return new Response(imageResponse.body, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    // Return the letterboxed 2:1 image
    return new Response(resizedResponse.body, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
};
