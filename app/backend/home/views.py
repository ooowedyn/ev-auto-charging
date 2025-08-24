from django.shortcuts import render

# Create your views here.

def hello_world(request):
    if request.method =="POST":
        return render(request, "accountapp/helloworld.html")